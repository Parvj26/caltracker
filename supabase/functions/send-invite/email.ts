export interface InviteEmailParams {
  clientName: string;
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
    `Hi ${p.clientName},`,
    '',
    `${p.coachName} has invited you to train with ${p.workspaceName} on CalTracker.`,
    '',
    `Accept your invite: ${p.acceptUrl}`,
    '',
    `This link expires on ${expires}.`,
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(p.clientName)},</p>
<p>${escapeHtml(p.coachName)} has invited you to train with ${escapeHtml(p.workspaceName)} on CalTracker.</p>
<p><a href="${escapeHtml(p.acceptUrl)}">Accept your invite</a></p>
<p>This link expires on ${expires}.</p>`;
  return { subject, html, text };
}
