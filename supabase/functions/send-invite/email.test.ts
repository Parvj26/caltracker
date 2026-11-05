import { assert, assertEquals } from '@std/assert';
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
  assert(html.includes('<a href="https://caltracker.app/invite/abc">Join Fit &amp; Co</a>'), html);
  assert(text.includes('Join Fit & Co: https://caltracker.app/invite/abc'), text);
  assert(text.includes('This link expires on 2026-11-19.'));
});

Deno.test('the email says only a password is needed', () => {
  const { html, text } = renderInviteEmail(params);
  assert(text.includes("Tap the link on your phone and choose a password. That's it."), text);
  assert(html.includes('choose a password'), html);
});
