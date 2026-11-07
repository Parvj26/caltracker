import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { renderInviteEmail } from './email.ts';

const params = {
  clientFirstName: 'Sam',
  coachName: 'Alex Coach',
  workspaceName: 'Fit & Co',
  acceptUrl: 'https://caltracker.app/invite/abc',
  expiresAt: new Date('2026-11-19T10:00:00Z'),
};

Deno.test('the invite button says "Join {business}" and links to the invite page', () => {
  const { subject, html, text } = renderInviteEmail(params);
  assertEquals(subject, 'Alex Coach invited you to CalTracker');
  assert(/<a href="https:\/\/caltracker\.app\/invite\/abc"[^>]*>Join Fit &amp; Co<\/a>/.test(html), html);
  assertStringIncludes(text, 'Join Fit & Co: https://caltracker.app/invite/abc');
  assertStringIncludes(text, 'This link expires on 2026-11-19.');
});

Deno.test('the button is a table-based button in brand ink and lime', () => {
  const { html } = renderInviteEmail(params);
  assertStringIncludes(html, '<table role="presentation"');
  assertStringIncludes(html, 'bgcolor="#121212"');
  assertStringIncludes(html, 'background-color:#121212');
  assertStringIncludes(html, '#C8F169');
  // The button link carries its own colour so clients that drop the cell background still show readable text.
  assert(/<a href="https:\/\/caltracker\.app\/invite\/abc"[^>]*style="[^"]*color:#FFFFFF/.test(html), html);
});

Deno.test('the plain link is printed under the button for clients that strip styles', () => {
  const { html } = renderInviteEmail(params);
  const buttonEnd = html.indexOf('</table>');
  const plain = html.indexOf('>https://caltracker.app/invite/abc</a>');
  assert(buttonEnd > 0 && plain > buttonEnd, html);
});

Deno.test('both versions tell new clients where to get the app', () => {
  const { html, text } = renderInviteEmail(params);
  const line = "New to CalTracker? You'll be able to get the app from the invite page.";
  assertStringIncludes(text, line);
  assertStringIncludes(html, 'New to CalTracker? You&#39;ll be able to get the app from the invite page.');
  // Order matches: link, then the new-to-app line.
  assert(text.indexOf('Join Fit & Co:') < text.indexOf(line), text);
});

Deno.test('the email says only a password is needed', () => {
  const { html, text } = renderInviteEmail(params);
  assertStringIncludes(text, "Tap the link on your phone and choose a password. That's it.");
  assertStringIncludes(html, 'choose a password');
});

Deno.test('the workspace name, names and URL are escaped in the HTML', () => {
  const { html, text } = renderInviteEmail({
    ...params,
    clientFirstName: '<b>Sam</b>',
    coachName: 'Alex "The Coach"',
    workspaceName: `<script>alert('x')</script> & Co`,
    acceptUrl: 'https://caltracker.app/invite/abc"><img src=x>',
  });
  assert(!html.includes('<script>'), html);
  assert(!html.includes('<img'), html);
  assert(!html.includes('<b>Sam'), html);
  assertStringIncludes(html, 'Join &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; Co</a>');
  assertStringIncludes(html, 'Alex &quot;The Coach&quot;');
  assertStringIncludes(html, 'href="https://caltracker.app/invite/abc&quot;&gt;&lt;img src=x&gt;"');
  // The plain-text version is not HTML, so it keeps the name as typed.
  assertStringIncludes(text, `Join <script>alert('x')</script> & Co: `);
});
