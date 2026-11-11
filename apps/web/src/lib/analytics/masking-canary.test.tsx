// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { record } from 'posthog-js/rrweb';
import { describe, expect, it } from 'vitest';
import { Button, Chip, Tile } from '@/components/ui';
import { CoachAvatar } from '@/components/coach-avatar';
import { LineChart as StrengthChart } from '@/components/charts/line-chart';
import { LineChart as ProgressChart } from '@/app/(coach)/clients/[clientId]/progress/line-chart';
import { RECORDING_CONFIG } from './replay-config';

/**
 * Masking canary: records a page full of a fake client's details with the rrweb recorder that ships inside
 * posthog-js, configured the way posthog-js configures it from our `session_recording` options, and checks the
 * recorded payload never contains the canary while fixed copy marked `data-ph-safe` stays readable.
 */

const CANARY = 'Zebracanary';
const posthogVersion = (createRequire(import.meta.url)('posthog-js/package.json') as { version: string }).version;

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
      <span className="fill" style={{ width: '73%' }} />
      <time dateTime="2026-03-04T10:00:00Z">4 Mar</time>
      <div data-date="2026-03-05" data-client-id="0b8c2f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f" data-testid="food-day-2026-11-10">
        day
      </div>
      <div role="progressbar" aria-valuenow={83} aria-valuemin={0} aria-valuemax={97} />
      <svg viewBox="0 0 10 10">
        <polyline points="1,83.25 2,79.75" />
      </svg>
      <ProgressChart
        title="Weight"
        axisFormat={(v) => `${v} kg`}
        points={[
          { date: '2026-03-01', label: '1 Mar', value: 83.25, text: '83.25 kg' },
          { date: '2026-03-08', label: '8 Mar', value: 79.75, text: '79.75 kg' },
        ]}
      />
      <StrengthChart
        title="Squat"
        summary="Squat best set"
        yLabel={(v) => `${v} kg`}
        xLabel={(v) => `day ${v}`}
        points={[
          { x: 1, y: 83.25, label: '83.25 kg' },
          { x: 8, y: 79.75, label: '79.75 kg' },
        ]}
      />
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
  it('runs against the posthog-js version it was written for', () => {
    // POSTHOG_RRWEB_DEFAULTS is copied from this version's `_startRecorder`. After an upgrade, re-derive it from
    // node_modules/posthog-js/lib/src/extensions/replay/external/lazy-loaded-session-recorder.js, then bump this.
    expect(posthogVersion, 'posthog-js was upgraded: re-check the recording options (see comment)').toBe('1.447.3');
  });

  it('records nothing of the client: names, notes, typed values, photos, labels, emails', () => {
    const json = recordFullSnapshot();
    expect(json).not.toContain(CANARY);
    expect(json.toLowerCase()).not.toContain(CANARY.toLowerCase());
  });

  it('records no dates, record ids, test ids, numbers or chart data', () => {
    const json = recordFullSnapshot();
    for (const leak of ['2026-03-04', '2026-03-05', '2026-03-01', '0b8c2f9e', 'food-day', '"83"', '"97"', '83.25', '79.75', '1,83', 'circle', '73%']) {
      expect(json, leak).not.toContain(leak);
    }
    // An unblocked SVG keeps its shape attributes masked; the two charts are blocked whole (no circles, no points).
    expect(json).not.toMatch(/"points":"[\d,. ]+"/);
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
