import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { renderClientDeletedEmail } from './email.ts';

Deno.test('client deleted email: subject names the client, body says nothing is needed', () => {
  const m = renderClientDeletedEmail({ coachFirstName: 'Luis', clientName: 'Sam Lee' });
  assertEquals(m.subject, 'Sam Lee deleted their CalTracker account');
  assertStringIncludes(m.text, 'Hi Luis,');
  assertStringIncludes(m.text, 'at their request');
  assertStringIncludes(m.text, "There's nothing you need to do.");
  assertStringIncludes(m.html, 'Sam Lee');
});

Deno.test('client deleted email: names are escaped in HTML', () => {
  const m = renderClientDeletedEmail({ coachFirstName: '<b>', clientName: 'Sam & <script>' });
  assert(!m.html.includes('<script>'));
  assertStringIncludes(m.html, 'Sam &amp; &lt;script&gt;');
});

Deno.test('client deleted email: falls back when names are missing', () => {
  const m = renderClientDeletedEmail({ coachFirstName: '', clientName: '' });
  assertEquals(m.subject, 'A client deleted their CalTracker account');
  assertStringIncludes(m.text, 'Hi,');
});
