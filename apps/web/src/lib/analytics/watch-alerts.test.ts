// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { watchAlerts } from './alert-code';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  document.body.innerHTML = '';
});

function alertEl(code: string): HTMLElement {
  const p = document.createElement('p');
  p.setAttribute('role', 'alert');
  p.setAttribute('data-error-code', code);
  p.textContent = 'Luis is not a client';
  return p;
}

it('reports an alert when it appears and again when its code changes in place, by code only', async () => {
  const report = vi.fn();
  stop = watchAlerts(document.body, report);
  const wrapper = document.createElement('div');
  const p = alertEl('invite_plan_no_program');
  wrapper.append(p);
  document.body.append(wrapper);
  await flush();
  expect(report.mock.calls).toEqual([['invite_plan_no_program']]);

  p.setAttribute('data-error-code', 'invite_plan_no_start');
  await flush();
  expect(report.mock.calls).toEqual([['invite_plan_no_program'], ['invite_plan_no_start']]);

  p.setAttribute('data-error-code', 'invite_plan_no_start');
  await flush();
  expect(report).toHaveBeenCalledTimes(2);
});

it('ignores a code change on something that is not an alert, and stops when asked', async () => {
  const report = vi.fn();
  stop = watchAlerts(document.body, report);
  const div = document.createElement('div');
  document.body.append(div);
  div.setAttribute('data-error-code', 'field_required');
  await flush();
  expect(report).not.toHaveBeenCalled();
  stop();
  document.body.append(alertEl('field_required'));
  await flush();
  expect(report).not.toHaveBeenCalled();
});
