// "Your client deleted their account" email to the coach. Same plain style as the invite email
// (send-invite/email.ts); no button, since the coach has nothing to do.

export interface ClientDeletedEmailParams {
  coachFirstName: string;
  /** Captured before the delete: the profile is gone by the time this is sent. */
  clientName: string;
}

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function renderClientDeletedEmail(p: ClientDeletedEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const name = p.clientName.trim() || 'A client';
  const greeting = p.coachFirstName.trim() ? `Hi ${p.coachFirstName.trim()},` : 'Hi,';
  const subject = `${name} deleted their CalTracker account`;
  const lines = [
    `${name} deleted their CalTracker account today. Their account and everything they saved (workouts, meals, messages, body scans and photos) were deleted at their request.`,
    "They're no longer in your client list. There's nothing you need to do.",
  ];
  const text = [greeting, '', ...lines.flatMap((l) => [l, '']), 'CalTracker'].join('\n');
  const html = `<p>${escapeHtml(greeting)}</p>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<p>CalTracker</p>`;
  return { subject, html, text };
}
