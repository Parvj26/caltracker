export interface InviteEmailParams {
  /** The greeting uses the first name only: "Hi Sam,". */
  clientFirstName: string;
  coachName: string;
  workspaceName: string;
  acceptUrl: string;
  expiresAt: Date;
}

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function renderInviteEmail(p: InviteEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${p.coachName} invited you to CalTracker`;
  const expires = p.expiresAt.toISOString().slice(0, 10);
  const text = [
    `Hi ${p.clientFirstName},`,
    '',
    `${p.coachName} has invited you to train with ${p.workspaceName} on CalTracker.`,
    '',
    `Join ${p.workspaceName}: ${p.acceptUrl}`,
    '',
    "Tap the link on your phone and choose a password. That's it.",
    '',
    `This link expires on ${expires}.`,
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(p.clientFirstName)},</p>
<p>${escapeHtml(p.coachName)} has invited you to train with ${escapeHtml(p.workspaceName)} on CalTracker.</p>
<p><a href="${escapeHtml(p.acceptUrl)}">Join ${escapeHtml(p.workspaceName)}</a></p>
<p>Tap the link on your phone and choose a password. That's it.</p>
<p>This link expires on ${expires}.</p>`;
  return { subject, html, text };
}
