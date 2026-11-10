import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { renderWorkspaceClosedEmail } from './email.ts';

Deno.test('workspace-closed email: subject, greeting and the three lines from the mockup', () => {
  const m = renderWorkspaceClosedEmail({ clientFirstName: 'Kay', coachName: 'Luis Bueno' });
  assertEquals(m.subject, 'Your coach has closed their CalTracker workspace');
  assertStringIncludes(m.text, 'Hi Kay,');
  assertStringIncludes(m.text, 'Luis Bueno has closed their coaching workspace on CalTracker');
  assertStringIncludes(m.text, 'they can invite you with this email address');
  assertStringIncludes(m.text, 'Settings → Delete account, or reply to support@caltracker.app');
  assertStringIncludes(m.html, '<p>Hi Kay,</p>');
});

Deno.test('workspace-closed email: escapes names and falls back when they are missing', () => {
  const m = renderWorkspaceClosedEmail({ clientFirstName: ' ', coachName: '<b>Sam</b>' });
  assertStringIncludes(m.html, '&lt;b&gt;Sam&lt;/b&gt; has closed');
  assert(!m.html.includes('<b>Sam'));
  assertStringIncludes(m.text, 'Hi,');
  assertStringIncludes(renderWorkspaceClosedEmail({ clientFirstName: 'K', coachName: '' }).text, 'Your coach has closed');
});
